import importlib.util
import json
import os
import socket
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = PROJECT_ROOT / "agent" / "server.py"
SPEC = importlib.util.spec_from_file_location("local_agent_server", SERVER_PATH)
server = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server
SPEC.loader.exec_module(server)


class WorkspaceSafetyTests(unittest.TestCase):
    def setUp(self):
        self.original_settings = server.SETTINGS
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name).resolve()
        server.configure(replace(server.SETTINGS, workspace=self.workspace))

    def tearDown(self):
        server.configure(self.original_settings)
        self.temporary.cleanup()

    def test_blocks_parent_traversal(self):
        with self.assertRaisesRegex(ValueError, "outside the workspace"):
            server.safe_path("../outside.txt")

    def test_blocks_absolute_path(self):
        with self.assertRaisesRegex(ValueError, "relative path"):
            server.safe_path(str((self.workspace.parent / "outside.txt").resolve()))

    def test_create_never_overwrites(self):
        server.create_file("notes/example.txt", "first")
        with self.assertRaises(FileExistsError):
            server.create_file("notes/example.txt", "second")
        self.assertEqual((self.workspace / "notes" / "example.txt").read_text(encoding="utf-8"), "first")

    def test_edit_requires_one_exact_match(self):
        server.create_file("example.txt", "same same")
        with self.assertRaisesRegex(ValueError, "exactly one occurrence"):
            server.edit_file("example.txt", "same", "changed")

    def test_edit_replaces_one_match_atomically(self):
        server.create_file("example.txt", "before")
        result = server.edit_file("example.txt", "before", "after")
        self.assertTrue(result["edited"])
        self.assertEqual((self.workspace / "example.txt").read_text(encoding="utf-8"), "after")

    def test_blocks_symlink_when_supported(self):
        outside = self.workspace.parent / f"{self.workspace.name}-outside"
        outside.mkdir(exist_ok=True)
        link = self.workspace / "linked"
        try:
            os.symlink(outside, link, target_is_directory=True)
        except OSError as exc:
            self.skipTest(f"Symlink creation is unavailable: {exc}")
        try:
            with self.assertRaisesRegex(ValueError, "outside the workspace|reparse points"):
                server.safe_path("linked/file.txt")
        finally:
            link.unlink(missing_ok=True)
            outside.rmdir()


class WebSafetyTests(unittest.TestCase):
    def test_blocks_loopback(self):
        with self.assertRaisesRegex(ValueError, "local or private"):
            server.validate_public_url("http://127.0.0.1/")

    def test_blocks_unapproved_port(self):
        with self.assertRaisesRegex(ValueError, "port 8080"):
            server.validate_public_url("https://example.com:8080/")

    def test_blocks_mixed_public_and_private_dns_answers(self):
        answers = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
        ]
        with patch.object(server.socket, "getaddrinfo", return_value=answers):
            with self.assertRaisesRegex(ValueError, "local or private"):
                server.validate_public_url("https://example.com/")

    def test_blocks_non_global_carrier_grade_nat_address(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("100.64.0.1", 443))]
        with patch.object(server.socket, "getaddrinfo", return_value=answers):
            with self.assertRaisesRegex(ValueError, "local or private"):
                server.validate_public_url("https://example.com/")

    def test_returns_a_pinned_public_ip(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch.object(server.socket, "getaddrinfo", return_value=answers):
            parsed, address = server.validate_public_url("https://example.com/page")
        self.assertEqual(parsed.hostname, "example.com")
        self.assertEqual(address, "93.184.216.34")


class ConfigurationTests(unittest.TestCase):
    def test_relative_paths_resolve_from_config_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_path = root / "config.json"
            config_path.write_text(json.dumps({"files": {"workspace": "./data", "static_root": "./public"}}), encoding="utf-8")
            settings = server.load_settings(config_path)
            self.assertEqual(settings.workspace, (root / "data").resolve())
            self.assertEqual(settings.static_root, (root / "public").resolve())

    def test_environment_can_override_model_endpoint_without_storing_a_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            config_path = Path(temporary) / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            with patch.dict(os.environ, {"LOCAL_AGENT_MODEL_API": "http://127.0.0.1:1234/v1/chat/completions"}):
                settings = server.load_settings(config_path)
            self.assertEqual(settings.model_api, "http://127.0.0.1:1234/v1/chat/completions")
            self.assertNotIn("api_key", server.public_settings())


class ContextManagementTests(unittest.TestCase):
    def setUp(self):
        self.original_settings = server.SETTINGS

    def tearDown(self):
        server.configure(self.original_settings)

    def test_tool_results_are_bounded_before_reentering_context(self):
        server.configure(replace(server.SETTINGS, max_tool_result_chars=500))
        serialized = server.serialize_tool_result({"url": "https://example.com", "text": "x" * 5000})
        self.assertLessEqual(len(serialized), 500)
        self.assertIn("compacted", serialized)

    def test_preparation_discards_old_chat_before_current_request(self):
        server.configure(replace(
            server.SETTINGS,
            context_window=8192,
            context_reserve_tokens=2048,
            max_tokens=1024,
            max_tool_result_chars=500,
            chars_per_token=1.0,
            token_counting="estimate",
        ))
        messages = [
            {"role": "system", "content": "rules"},
            {"role": "user", "content": "old question " + "x" * 7000},
            {"role": "assistant", "content": "old answer"},
            {"role": "user", "content": "current question"},
        ]
        prepared, token_count = server.prepare_messages(messages, allow_tools=True)
        self.assertEqual([item["content"] for item in prepared if item["role"] == "user"], ["current question"])
        self.assertLessEqual(token_count, server.SETTINGS.context_window - server.SETTINGS.context_reserve_tokens)

    def test_llama_token_counter_falls_back_to_estimate(self):
        server.configure(replace(server.SETTINGS, token_counting="llama_cpp"))
        messages = [{"role": "user", "content": "hello"}]
        with patch.object(server, "_post_json", side_effect=OSError("offline")):
            count = server.prompt_token_count(messages, [])
        self.assertEqual(count, server.estimate_prompt_tokens(messages, []))

    def test_model_timeout_is_classified_for_safe_handling(self):
        with patch.object(server.urllib.request, "urlopen", side_effect=TimeoutError("slow")):
            with self.assertRaises(server.ModelTimeoutError):
                server.call_model([{"role": "user", "content": "hello"}])

    def test_context_retry_timeout_returns_a_safe_response(self):
        failures = [server.ModelContextError("full"), server.ModelTimeoutError("slow")]
        with patch.object(server, "call_model", side_effect=failures):
            response = server.run_agent([{"role": "user", "content": "hello"}])
        self.assertTrue(response["context"]["safely_stopped"])
        self.assertEqual(response["usage"], {})


if __name__ == "__main__":
    unittest.main()

import unittest

from fastapi.testclient import TestClient

from pydrr_studio.api import app


class ApiSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_loopback_browser_origin_is_allowed(self) -> None:
        response = self.client.get(
            "/api/health",
            headers={"Origin": "http://127.0.0.1:9123"},
        )
        self.assertEqual(response.status_code, 200)

    def test_former_github_pages_origin_is_rejected(self) -> None:
        response = self.client.get(
            "/api/health",
            headers={"Origin": "https://farrell236.github.io"},
        )
        self.assertEqual(response.status_code, 403)

    def test_untrusted_browser_origin_is_rejected(self) -> None:
        response = self.client.get(
            "/api/health",
            headers={"Origin": "https://example.com"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "Origin is not allowed"})

    def test_non_browser_local_request_is_allowed(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()

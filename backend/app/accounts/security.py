"""Passwords and API keys.

- Passwords are stored as Argon2id hashes in PHC format, with Authelia's default
  parameters (m=65536, t=3, p=4): the same hash works in the users file Authelia reads,
  so there is only one password.
- API keys are encrypted with AES-256-GCM. User and service are "associated data":
  a ciphertext copied into another user's or service's row does not decrypt.
"""
import base64
import binascii
import os
from typing import Optional

from cryptography.exceptions import InvalidKey, InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

from app.config import get_settings


ARGON2_MEMORY_KIB = 65536
ARGON2_ITERATIONS = 3
ARGON2_LANES = 4
ARGON2_KEY_LENGTH = 32
ARGON2_SALT_LENGTH = 16

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4), validate=True)


def check_password_policy(password: str, username: str = "") -> Optional[str]:
    """Why the password is not acceptable, or None if it is."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"The password must have at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"The password can have at most {MAX_PASSWORD_LENGTH} characters."
    if username and password.lower() == username.lower():
        return "The password cannot be the same as the username."
    if len(set(password)) < 5:
        return "The password is too repetitive."
    return None


def hash_password(password: str) -> str:
    """Argon2id hash in PHC format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>."""
    salt = os.urandom(ARGON2_SALT_LENGTH)
    digest = Argon2id(
        salt=salt,
        length=ARGON2_KEY_LENGTH,
        iterations=ARGON2_ITERATIONS,
        lanes=ARGON2_LANES,
        memory_cost=ARGON2_MEMORY_KIB,
    ).derive(password.encode("utf-8"))
    return f"$argon2id$v=19$m={ARGON2_MEMORY_KIB},t={ARGON2_ITERATIONS},p={ARGON2_LANES}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, phc: str) -> bool:
    """True if the password matches the hash. An unreadable hash matches nothing."""
    try:
        empty, algorithm, version, params, salt, digest = phc.split("$")
        if empty or algorithm != "argon2id" or version != "v=19":
            return False
        values = dict(part.split("=") for part in params.split(","))
        expected = _unb64(digest)
        Argon2id(
            salt=_unb64(salt),
            length=len(expected),
            iterations=int(values["t"]),
            lanes=int(values["p"]),
            memory_cost=int(values["m"]),
        ).verify(password.encode("utf-8"), expected)
        return True
    except (InvalidKey, ValueError, KeyError, binascii.Error):
        return False


NONCE_LENGTH = 12


def _aad(username: str, service: str) -> bytes:
    return f"argus:v1:{username}:{service}".encode("utf-8")


def encrypt_secret(plaintext: str, *, username: str, service: str) -> bytes:
    """Ciphertext = nonce (12 bytes) + AES-GCM(plaintext)."""
    nonce = os.urandom(NONCE_LENGTH)
    box = AESGCM(get_settings().secret_key).encrypt(nonce, plaintext.encode("utf-8"), _aad(username, service))
    return nonce + box


def decrypt_secret(blob: bytes, *, username: str, service: str) -> Optional[str]:
    """The plaintext, or None if the data is not authentic (wrong key or row, tampered data)."""
    if len(blob) <= NONCE_LENGTH:
        return None
    try:
        plain = AESGCM(get_settings().secret_key).decrypt(blob[:NONCE_LENGTH], blob[NONCE_LENGTH:], _aad(username, service))
    except InvalidTag:
        return None
    return plain.decode("utf-8")

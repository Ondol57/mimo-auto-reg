#!/usr/bin/env python3
"""Kaer API signup from a CI runner. Secretless: temp inbox from mail.tm.

Prints one summary line. The API key is RSA-sealed with KAER_PUBKEY so public
repo logs never carry a usable secret; only the VPS private key can open it.
"""
import base64
import http.cookiejar
import json
import os
import random
import string
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE = "https://api.kaer.ai"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
PUBKEY = os.environ.get("KAER_PUBKEY") or """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzRRsKxdmdHPQ/VSOGpxf
ljOqM8oLc8VMH5pAQNG4MbV8zD6x80NQ6uLjUxjZnd2cN/Lsw78/8fgWfrX2xl5r
c8bTCgpsfSfoa2mxvT1Xuw0gW+0/wZfh/BkFrxAHfbfOMHBz5SAYMtHt0zmq3OqI
qJe54rMq2BNw6IHxLYXJgDyqGpdXafaXRpHtDpz++ubhNjsJ/FUCHpr9iMbdcT9M
Jj1JVHU/oqiFwhXWJILTjWsdUqWG5St0+lEwdVUfRPWkIYAl+CnEpT1IU363xFZi
zCX42NORMsiYRPDszfSQx5zNfJ9SrOIUWE/4yM2sV1dx7EVvfSwdgyW79GX3A87m
nwIDAQAB
-----END PUBLIC KEY-----
"""

JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))


def call(url, method="GET", body=None, headers=None, timeout=30):
    h = {"user-agent": UA}
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    req = urllib.request.Request(url, method=method, data=data, headers=h)
    try:
        r = OPENER.open(req, timeout=timeout)
        raw = r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"
    try:
        return r.status, json.loads(raw)
    except Exception:
        return r.status, raw


def temp_inbox():
    doms = call("https://api.mail.tm/domains?page=1")[1]
    dom = doms["hydra:member"][0]["domain"]
    user = "k" + "".join(random.choices(string.ascii_lowercase + string.digits, k=9))
    addr, pw = f"{user}@{dom}", "Passw0rd!23"
    st, acc = call("https://api.mail.tm/accounts", "POST", {"address": addr, "password": pw})
    if st >= 400:
        raise RuntimeError(f"mail.tm account {st} {acc}")
    st, tok = call("https://api.mail.tm/token", "POST", {"address": addr, "password": pw})
    if st >= 400:
        raise RuntimeError(f"mail.tm token {st} {tok}")
    return addr, tok["token"]


def read_code(tok, timeout=180):
    deadline = time.time() + timeout
    hdr = {"authorization": "Bearer " + tok}
    while time.time() < deadline:
        st, m = call("https://api.mail.tm/messages", headers=hdr)
        if st == 200 and m.get("hydra:totalItems", 0):
            mid = m["hydra:member"][0]["id"]
            st, msg = call(f"https://api.mail.tm/messages/{mid}", headers=hdr)
            if st == 200:
                for w in (msg.get("subject") or "").replace(":", " ").split():
                    if len(w) == 6 and w.isdigit():
                        return w
        time.sleep(5)
    return None


def seal(secret):
    """RSA-encrypt with KAER_PUBKEY; returns base64 ciphertext ('' if no pubkey)."""
    if not PUBKEY or not secret:
        return ""
    with tempfile.TemporaryDirectory() as d:
        pub, src, out = (os.path.join(d, n) for n in ("p.pem", "k.txt", "k.enc"))
        open(pub, "w").write(PUBKEY)
        open(src, "w").write(secret)
        p = subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", pub,
                            "-in", src, "-out", out], capture_output=True)
        if p.returncode != 0:
            return ""
        return base64.b64encode(open(out, "rb").read()).decode()


def main():
    addr, tok = temp_inbox()
    st, js = call(BASE + "/api/apiplat/auth/code", "POST", {"email": addr}, {"origin": BASE})
    if st >= 400:
        print(f"RESULT=code_req_{st} {js}", flush=True)
        return
    code = read_code(tok)
    if not code:
        print(f"RESULT=no_otp {addr}", flush=True)
        return
    st, js = call(BASE + "/api/apiplat/auth/verify", "POST",
                  {"email": addr, "code": code, "agreed": True}, {"origin": BASE})
    if st >= 400:
        print(f"RESULT=verify_{st} {js}", flush=True)
        return
    st, acc = call(BASE + "/api/apiplat/account", headers={"origin": BASE})
    grant = credit = None
    if st == 200 and isinstance(acc, dict):
        grant = acc["account"]["grantDecision"]
        credit = acc["balance"]["freeCreditUsd"]
    st, ks = call(BASE + "/api/apiplat/keys", "POST", {"name": "ci"}, {"origin": BASE})
    key = ks.get("secret") if st < 400 and isinstance(ks, dict) else None
    enc = seal(key)
    print(f"RESULT=ok GRANT={grant} CREDIT={credit} EMAIL={addr} "
          f"KEYENC={enc or ('NOSELA' if key else 'NOKEY')}", flush=True)


if __name__ == "__main__":
    main()

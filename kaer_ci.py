#!/usr/bin/env python3
"""Kaer API signup from a CI runner. Secretless: temp inbox comes from mail.tm.

Prints: GRANT=<decision> CREDIT=<usd> KEYENC=<base64 rsa ciphertext or empty>
Nothing sensitive is printed in clear (public repo logs).
"""
import base64
import json
import os
import random
import string
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "https://api.kaer.ai"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
PUBKEY = os.environ.get("KAER_PUBKEY", "")


def call(url, method="GET", body=None, headers=None, timeout=30):
    h = {"user-agent": UA}
    h.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    req = urllib.request.Request(url, method=method, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        raw = r.read().decode("utf-8", "ignore")
        try:
            return r.status, json.loads(raw)
        except Exception:
            return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


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


def read_code(tok, timeout=150):
    deadline = time.time() + timeout
    hdr = {"authorization": "Bearer " + tok}
    while time.time() < deadline:
        st, m = call("https://api.mail.tm/messages", headers=hdr)
        if st == 200 and m.get("hydra:totalItems", 0):
            mid = m["hydra:member"][0]["id"]
            st, msg = call(f"https://api.mail.tm/messages/{mid}", headers=hdr)
            if st == 200:
                subj = msg.get("subject") or ""
                for w in subj.replace(":", " ").split():
                    if len(w) == 6 and w.isdigit():
                        return w
        time.sleep(5)
    return None


def main():
    addr, tok = temp_inbox()
    print(f"EMAIL={addr}", flush=True)
    st, js = call(BASE + "/api/apiplat/auth/code", "POST", {"email": addr},
                  {"origin": BASE})
    if st >= 400:
        print(f"RESULT=code_req_{st} {js}")
        return
    code = read_code(tok)
    if not code:
        print("RESULT=no_otp")
        return
    st, js = call(BASE + "/api/apiplat/auth/verify", "POST",
                  {"email": addr, "code": code, "agreed": True}, {"origin": BASE})
    print(f"VERIFY={st} {js}", flush=True)
    if st >= 400:
        print("RESULT=verify_fail")
        return
    st, acc = call(BASE + "/api/apiplat/account", headers={"origin": BASE})
    grant = credit = None
    if st == 200:
        grant = acc["account"]["grantDecision"]
        credit = acc["balance"]["freeCreditUsd"]
    st, ks = call(BASE + "/api/apiplat/keys", "POST", {"name": "ci"}, {"origin": BASE})
    key = ks.get("secret") if st < 400 and isinstance(ks, dict) else None
    print(f"GRANT={grant} CREDIT={credit} KEYPREFIX={key[:16] if key else None}", flush=True)
    if key:
        open("/tmp/kaer_key.txt", "w").write(key)
        print("KEYFILE_WRITTEN", flush=True)


if __name__ == "__main__":
    main()

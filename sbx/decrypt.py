import base64, json, os, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
home = os.path.expanduser("~")
priv = serialization.load_pem_private_key(open(f"{home}/wrap.pem","rb").read(), password=None)
b = json.load(open(sys.argv[1])); d = lambda s: base64.b64decode(b[s])
k = priv.decrypt(d("wrapped_key"), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
p = json.loads(AESGCM(k).decrypt(d("nonce"), d("ct"), b"fv1-build-v1"))
out = f"{home}/ks"; os.makedirs(out, mode=0o700, exist_ok=True)
ks = f"{out}/founder.p12"
with os.fdopen(os.open(ks, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600), "wb") as f: f.write(base64.b64decode(p["keystore_b64"]))
with os.fdopen(os.open(f"{out}/env.sh", os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600), "w") as f:
    f.write(f"export FOUNDER_KEYSTORE_FILE='{ks}'\nexport FOUNDER_KEYSTORE_PASSWORD='{p['store_password']}'\nexport FOUNDER_KEY_PASSWORD='{p['key_password']}'\nexport FOUNDER_KEY_ALIAS='{p['alias']}'\n")
print("descifrado OK")

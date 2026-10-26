"""Tells apart 'the proxy has no UDP' from 'this machine cannot send UDP'.
Run it with the VPN on, then with it off."""
import socket, struct, sys, uuid
def stun(): return bytes([0,1,0,0,0x21,0x12,0xA4,0x42]) + uuid.uuid4().bytes[:12]

def direct():
    ip = socket.gethostbyname("stun.l.google.com")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(5)
    try:
        s.sendto(stun(), (ip, 19302)); d, src = s.recvfrom(2048)
        print(f"  UDP straight out of this machine   OK  {len(d)}B from {src[0]}")
        return True
    except Exception as e:
        print(f"  UDP straight out of this machine   {type(e).__name__}  <- nothing can use UDP here")
        return False
    finally: s.close()

def via_proxy(host, port, user, pw):
    t = socket.create_connection((host, port), timeout=8)
    t.sendall(bytes([5,1,2 if user else 0])); g = t.recv(2)
    if user and g[1] == 2:
        t.sendall(bytes([1,len(user)])+user.encode()+bytes([len(pw)])+pw.encode())
        if t.recv(2)[1] != 0: print("  auth failed"); return
    t.sendall(bytes([5,3,0,1,0,0,0,0,0,0]))
    h = t.recv(4)
    if h[1] != 0: print(f"  UDP_ASSOCIATE refused rep={h[1]:#04x}  <- proxy has no UDP"); return
    raw = t.recv(6); rip = socket.inet_ntoa(raw[:4]); rport = struct.unpack("!H", raw[4:])[0]
    if rip == "0.0.0.0": rip = host
    print(f"  UDP_ASSOCIATE accepted, relay {rip}:{rport}")
    ip = socket.gethostbyname("stun.l.google.com")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(6)
    pkt = bytes([0,0,0,1]) + socket.inet_aton(ip) + struct.pack("!H",19302) + stun()
    try:
        s.sendto(pkt, (rip, rport)); d, src = s.recvfrom(2048)
        print(f"  STUN through the relay             OK  {len(d)}B from {src[0]}:{src[1]}")
    except Exception as e:
        print(f"  STUN through the relay             {type(e).__name__}")
    finally: s.close(); t.close()

if len(sys.argv) < 2:
    print("usage: python3 vpn_check.py socks5://user:pass@host:port"); raise SystemExit(2)
u = sys.argv[1].split("://",1)[1]
cred, hp = (u.split("@",1) + [""])[:2] if "@" in u else ("", u)
user, pw = (cred.split(":",1) + [""])[:2] if cred else ("","")
host, port = hp.rsplit(":",1)
print("checking UDP")
ok = direct()
via_proxy(host, int(port), user, pw)
print("\n  both fail  -> this machine or its VPN drops UDP; the proxy is not the problem")
print("  first ok, second not -> the proxy does not relay UDP")

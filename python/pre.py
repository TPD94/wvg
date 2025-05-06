import base64
import os
import xmltodict
import pyplayready


if "</WRMHEADER>".encode("utf-16-le") in base64.b64decode(pssh):
    from pyplayready import RemoteCdm
    print(cdrm_instance_fqdn)
else:
    from pywidevine import RemoteCdm
import base64
import requests



if "</WRMHEADER>".encode("utf-16-le") in base64.b64decode(pssh):
    from pyplayready import RemoteCdm
    from pyplayready import PSSH
    if selected_device == 'CDRM Instance default':
      remote_cdm_details = requests.get(
          url=f'{cdrm_instance_fqdn}/remotecdm/playready/deviceinfo'
      ).json()
    else:
       remote_cdm_details = requests.get(
          url=f'{cdrm_instance_fqdn}/remotecdm/playready/deviceinfo/{selected_device}',
          headers={
             'X-Secret-Key': api_key
          }
       ).json()
    r_cdm = RemoteCdm(
        security_level=remote_cdm_details['security_level'],
        host=f'{cdrm_instance_fqdn}/remotecdm/playready',
        secret=remote_cdm_details['secret'],
        device_name=remote_cdm_details['device_name']
    )
    session_id = r_cdm.open()
    challenge_pssh = PSSH(pssh)
    drm_challenge = r_cdm.get_license_challenge(session_id, challenge_pssh.wrm_headers[0])
else:
    from pywidevine import RemoteCdm
    from pywidevine import PSSH
    if selected_device == 'CDRM Instance default':
      remote_cdm_details = requests.get(
          url=f'{cdrm_instance_fqdn}/remotecdm/widevine/deviceinfo'
      ).json()
    else:
       remote_cdm_details = requests.get(
          url=f'{cdrm_instance_fqdn}/remotecdm/widevine/deviceinfo/{selected_device}',
          headers={
             'X-Secret-Key': api_key
          }
       ).json()
    r_cdm = RemoteCdm(
        device_type = remote_cdm_details['device_type'],
        system_id = remote_cdm_details['system_id'],
        security_level = remote_cdm_details['security_level'],
        host = f'{cdrm_instance_fqdn}/remotecdm/widevine',
        secret = remote_cdm_details['secret'],
        device_name = remote_cdm_details['device_name']

    )
    session_id = r_cdm.open()
    challenge_pssh = PSSH(pssh)
    drm_challenge = r_cdm.get_license_challenge(session_id, challenge_pssh)
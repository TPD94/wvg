try:
    r_cdm.parse_license(session_id, response)
except:
    try:
        r_cdm.parse_license(session_id, response.text)
    except:
        r_cdm.parse_license(session_id, response.content)

try:
    r_keys = "\n".join(
    f"{key.key_id.hex}:{key.key.hex()}" for key in r_cdm.get_keys(session_id)
)
except:
    r_keys = "\n".join(
        f"{key.kid.hex}:{key.key.hex()}" 
        for key in r_cdm.get_keys(session_id) 
        if key.type != 'SIGNING'
    )

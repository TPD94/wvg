response = requests.post(
    url=license_url,
    headers=headers.to_py(),
    data=drm_challenge
)
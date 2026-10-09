#!/usr/bin/env python3
"""Resolve the newest stable CE+ image (upstream publishes versioned tags)."""
import json
import re
import urllib.request

url = 'https://hub.docker.com/v2/repositories/overleafcep/sharelatex/tags/?page_size=100'
with urllib.request.urlopen(url, timeout=30) as response:
    tags = [item['name'] for item in json.load(response)['results']]
tags = [tag for tag in tags if re.fullmatch(r'\d+\.\d+\.\d+-ext-v\d+(?:\.\d+)*', tag)]
latest = max(tags, key=lambda tag: tuple(map(int, re.findall(r'\d+', tag))))
print(f'overleafcep/sharelatex:{latest}')

"""Read explicit secret sources, without evaluating shell syntax or printing values."""
import json,os,pathlib,re

def load(config,base):
    values={}
    for source in config.get('secret_files',[]):
        try:
            path=pathlib.Path(base)/source['path'];raw=path.read_text()
            if len(raw.encode())>1024*1024:raise ValueError('secret_file_too_large')
            if source['format']=='env':
                for line in raw.splitlines():
                    match=re.fullmatch(r'([A-Z][A-Z0-9_]{2,99})\s*=(.*)',line.strip())
                    if match:values[match[1]]=match[2].strip().strip('"').strip("'")
            elif source['format']=='json':
                data=json.loads(raw)
                for name,pointer in source['keys'].items():
                    value=data
                    for part in pointer[1:].split('/'):value=value[part.replace('~1','/').replace('~0','~')]
                    if isinstance(value,str) and value:values[name]=value
            else:raise ValueError('secret_file_format_invalid')
        except (OSError,ValueError,KeyError,TypeError):
            # Missing provider credentials become per-account source errors.
            # The independently stored worker role can still publish the error.
            continue
    values.update(json.loads((pathlib.Path(base)/config['secrets_file']).read_text()))
    values.update({k:v for k,v in os.environ.items() if k.startswith('MAIL_') and v})
    return values

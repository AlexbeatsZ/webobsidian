import { useEffect, useState } from 'react';
import { api, vaultRequestIdentity } from '../lib/api';
import { useStore } from '../lib/store';

export default function AttachmentView({ path }: { path: string }) {
  const stale = useStore(state => state.vaultSessionStale);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const pdf = /\.pdf$/i.test(path);
  useEffect(() => {
    let current = true;
    void vaultRequestIdentity().then(() => {
      if (current) setUrl(api.rawUrl(path));
    }).catch(cause => { if (current) setError(String(cause)); });
    return () => { current = false; };
  }, [path]);
  return <section className="markdown-preview attachment-view" aria-label="附件">
    <div className="preview-inner">
      <h2>{path.split('/').pop()}</h2>
      <p>{pdf ? '暂不支持应用内 PDF 阅读，可在浏览器中打开或下载。' : '此附件不支持文本编辑，可在浏览器中打开或下载。'}</p>
      {stale || error ? <p role="alert">{stale ? 'Vault 已切换，请重新加载应用；旧文档会话保留' : error}</p> : url ? <>
        <p><a href={url} target="_blank" rel="noopener noreferrer">{pdf ? '在浏览器中打开 PDF' : '在浏览器中打开附件'}</a></p>
        <p><a href={url} download={path.split('/').pop()}>下载附件</a></p>
      </> : <p>加载附件地址…</p>}
    </div>
  </section>;
}

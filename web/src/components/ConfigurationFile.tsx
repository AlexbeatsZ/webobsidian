import { useState, type ReactNode } from 'react';
import Icon from './Icon';
import { SettingRow } from './SettingRow';

/** Configuration files use the desktop's single external-open boundary. */
export default function ConfigurationFile({ path, name = '配置文件', desc, onOpen, children }: {
  path: string; name?: string; desc?: ReactNode; onOpen?: () => Promise<unknown>; children?: ReactNode;
}) {
  const [error, setError] = useState('');
  const desktop = window.webobsidianDesktop;
  const open = onOpen ?? (desktop ? () => desktop.openVaultPath(path) : undefined);
  const run = (work: () => Promise<unknown>) => {
    setError('');
    void Promise.resolve().then(work).catch(cause => setError(String(cause)));
  };
  return <>
    <SettingRow name={name} desc={<>{desc}{desc && <br />}<code>{path}</code></>}>
      {children}
      {open && <button type="button" title="在外部打开" aria-label={`在外部打开${name}`}
        onClick={() => run(open)}><Icon name="folder" size={16} /></button>}
      <button type="button" title="复制路径" aria-label={`复制${name}路径`} onClick={() => run(() => navigator.clipboard.writeText(path))}><Icon name="copy" size={16} /></button>
    </SettingRow>
    {error && <p role="alert">{error}</p>}
  </>;
}

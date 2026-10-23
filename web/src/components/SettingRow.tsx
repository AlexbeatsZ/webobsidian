import { cloneElement, isValidElement, useId, type ReactNode } from 'react';

/** Visual structure shared by native settings; each page keeps its own state. */
export function SettingRow({ name, desc, children, className = '' }: {
  name: ReactNode; desc?: ReactNode; children: ReactNode; className?: string;
}) {
  const id = useId();
  const field = isValidElement<{ id?: string }>(children) && typeof children.type === 'string'
    && ['input', 'select', 'textarea'].includes(children.type) ? children : null;
  const fieldId = field ? field.props.id ?? `${id}-control` : undefined;
  return <div className={`setting-row ${className}`} role="group" aria-labelledby={id}>
    <div className="info"><label className="name" id={id} htmlFor={fieldId}>{name}</label>{desc && <div className="desc">{desc}</div>}</div>
    <div className="control">{field ? cloneElement(field, { id: fieldId }) : children}</div>
  </div>;
}

export function SettingGroup({ title, desc, children, className = '' }: {
  title?: string; desc?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`setting-group ${className}`}>
    {title && <h3>{title}</h3>}{desc && <p className="setting-description">{desc}</p>}
    <div className="setting-group-body">{children}</div>
  </section>;
}

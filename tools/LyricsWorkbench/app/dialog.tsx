import { useId, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Icon } from './ui';

export function WorkbenchDialog({ title, description, icon, eyebrow = '听页 / 歌曲与歌词工作台', onDismiss, children }: {
  title: string; description: string; icon: ComponentProps<typeof Icon>['name']; eyebrow?: string;
  onDismiss: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const current = dialog.current;
    if (!current) return;
    const opener = document.activeElement;
    current.showModal();
    return () => {
      current.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return <dialog ref={dialog} className="workbench-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <header className="dialog-header">
      <span className="dialog-icon"><Icon name={icon} size={22} /></span>
      <div><p className="eyebrow">{eyebrow}</p><h2 id={`${id}-title`}>{title}</h2></div>
      <button type="button" className="dialog-close" aria-label="关闭弹窗" onClick={onDismiss}><Icon name="close" size={18} /></button>
    </header>
    <p className="dialog-description" id={`${id}-description`}>{description}</p>
    {children}
  </dialog>;
}

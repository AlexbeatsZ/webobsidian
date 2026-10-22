import { getTextInLanguage } from './lang/helpers';

/** Rule metadata only. React owns settings; no Obsidian widgets or plugin state. */
export class Option {
  ruleAlias = '';
  hidden = false;
  constructor(
    public configKey: string,
    public nameKey: string,
    public descriptionKey: string,
    public defaultValue: any,
    ruleAlias?: string | null,
  ) {
    this.ruleAlias = ruleAlias ?? '';
  }
  getName() {
    return getTextInLanguage(this.nameKey);
  }
  getDescription() {
    return getTextInLanguage(this.descriptionKey);
  }
  hide() {
    this.hidden = true;
  }
  unhide() {
    this.hidden = false;
  }
}
export class BooleanOption extends Option {
  constructor(
    key: string,
    name: string,
    desc: string,
    value: boolean,
    alias?: string | null,
    public onChange?: unknown,
  ) {
    super(key, name, desc, value, alias);
  }
}
export class TextOption extends Option {}
export class TextAreaOption extends Option {}
export class MomentFormatOption extends Option {}
export class DropdownRecord {
  constructor(
    public value: string,
    public description: string,
  ) {}
  getDisplayValue() {
    return getTextInLanguage(this.value);
  }
}
export class DropdownOption extends Option {
  constructor(
    key: string,
    name: string,
    desc: string,
    value: string,
    public options: DropdownRecord[],
    alias?: string | null,
  ) {
    super(key, name, desc, value, alias);
  }
}
export class MdFilePickerOption extends Option {
  constructor(key: string, name: string, desc: string, alias?: string | null) {
    super(key, name, desc, [], alias);
  }
}

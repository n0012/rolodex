export class TFile {
  path: string = '';
  basename: string = '';
  name: string = '';
}

export class TFolder {
  path: string = '';
  name: string = '';
}

export class Notice {
  constructor(public message: string, public duration?: number) {}
}

export class ItemView {}
export class Plugin {}
export class Modal {}

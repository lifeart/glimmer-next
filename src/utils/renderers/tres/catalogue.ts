import { cell, type Cell } from '@lifeart/gxt';
import type { TresCatalogue } from './types'
import * as THREE from 'three';

// Create extensible copy of THREE namespace
const extensibleCatalogue = { ...THREE } as unknown as TresCatalogue;

export const catalogue: Cell<TresCatalogue> = cell(extensibleCatalogue);

export const extend = (objects: TresCatalogue) => {
  Object.assign(catalogue.value, objects);
};

export default { catalogue, extend }
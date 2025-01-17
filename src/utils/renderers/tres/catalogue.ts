import { cell, type Cell } from '@lifeart/gxt';
import type { TresCatalogue } from './types'
import * as THREE from 'three';


// @ts-expect-error catalogue type
export const catalogue: Cell<TresCatalogue> = cell(THREE);

export const extend = (objects: any) => Object.assign(catalogue.value, objects)

export default { catalogue, extend }
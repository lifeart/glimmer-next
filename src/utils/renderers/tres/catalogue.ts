import { cell, type Cell } from '@lifeart/gxt';
import type { TresCatalogue } from './types'

export const catalogue: Cell<TresCatalogue> = cell({})

export const extend = (objects: any) => Object.assign(catalogue.value, objects)

export default { catalogue, extend }
/** The bundle's entry: installs the bridge's entry points as the `NestEngine` global. */

import { entryPoints } from './index.ts'

;(globalThis as { NestEngine?: typeof entryPoints }).NestEngine = entryPoints

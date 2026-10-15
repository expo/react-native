/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import registry from '../templates/registry.json';
import {MODIFIED} from '../templates/modifications.js';
import type {ComponentType} from 'react';

export type TemplateInfo = {
  slug: string;
  name: string;
  category: string;
  description: string;
};

export const astryxVersion: string = registry.astryxVersion;
export const templates: Array<TemplateInfo> = registry.templates;
export const modifications: Array<{slug: string; what: string; why: string}> =
  MODIFIED;

// Every template's page module, keyed by slug. Metro evaluates the context
// lazily, so a template's module loads when its screen first renders.
const pages = require.context('../templates', true, /\/page\.tsx$/);

export function templateComponent(slug: string): ComponentType<{}> {
  const key = `./${slug}/page.tsx`;
  const mod = pages(key);
  return mod.default;
}

export function templateInfo(slug: string): TemplateInfo | undefined {
  return templates.find(t => t.slug === slug);
}

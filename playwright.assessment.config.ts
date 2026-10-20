import { defineConfig } from '@playwright/test';
import learning from './playwright.learning.config';
export default defineConfig({ ...learning, testMatch: 'assessment-surfaces.spec.ts' });

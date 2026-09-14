// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        gray: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
        success: {
          100: '#DCFCE7',
          500: '#22C55E',
        },
        warning: {
          100: '#FEF3C7',
          500: '#F59E0B',
        },
        error: {
          100: '#FEE2E2',
          500: '#EF4444',
        },
        revision: {
          insert: '#16A34A',
          delete: '#DC2626',
          modify: '#2563EB',
          'insert-bg': '#DCFCE7',
          'delete-bg': '#FEE2E2',
          'modify-bg': '#DBEAFE',
        },
      },
      fontFamily: {
        ui: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        content: ['"Noto Serif CJK SC"', '"Songti SC"', 'SimSun', 'serif'],
      },
      spacing: {
        'header': '48px',
        'toolbar': '40px',
        'statusbar': '28px',
        'sidebar': '240px',
        'properties': '280px',
      },
    },
  },
  plugins: [],
}

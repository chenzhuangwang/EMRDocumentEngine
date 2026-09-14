-- Copyright (c) 2026 陈庄旺.
-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at https://mozilla.org/MPL/2.0/.
-- SPDX-License-Identifier: MPL-2.0

-- H2 Seed Data
-- Password: admin123 (BCrypt)
INSERT INTO t_user (id, username, password, real_name, role, enabled) VALUES
('u_admin_001', 'admin', '$2a$10$Ym6PJ9XeglWbytnPHhn9EufCBMmLSrwMFfs2FiM9TUejzK.Kpn3NO', 'Admin', 'admin', 1);

INSERT INTO t_user (id, username, password, real_name, role, enabled) VALUES
('u_user_001', 'doctor01', '$2a$10$Ym6PJ9XeglWbytnPHhn9EufCBMmLSrwMFfs2FiM9TUejzK.Kpn3NO', 'Dr. Zhang', 'user', 1);

INSERT INTO t_template (id, name, category, description, content, is_public, version, created_by, updated_by) VALUES
('tpl_blank', 'Blank', 'General', 'Blank document template', '{"header":[],"main":[{"id":"el_001","type":"text","value":"","size":16,"font":"SimSun"}],"footer":[]}', 1, 1, 'u_admin_001', 'u_admin_001');

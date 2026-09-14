-- Copyright (c) 2026 陈庄旺.
-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at https://mozilla.org/MPL/2.0/.
-- SPDX-License-Identifier: MPL-2.0

-- ============================================================
-- EMR Document Editor - 种子数据
-- ============================================================

USE emr_editor;

-- 默认管理员 (密码: admin123, BCrypt加密)
INSERT INTO t_user (id, username, password, real_name, role, enabled) VALUES
('u_admin_001', 'admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '系统管理员', 'admin', 1),
('u_designer_001', 'designer', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '模板设计员', 'designer', 1),
('u_user_001', 'doctor01', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '张医生', 'user', 1),
('u_user_002', 'doctor02', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '李医生', 'user', 1);

-- 默认模板
INSERT INTO t_template (id, name, category, description, content, is_public, version, created_by, updated_by) VALUES
('tpl_blank', '空白文档', '通用', '从头开始创建文档', '{"header":[],"main":[{"id":"el_001","type":"text","value":"","size":16,"font":"SimSun"}],"footer":[]}', 1, 1, 'u_admin_001', 'u_admin_001'),
('tpl_admission', '入院记录', '医疗文书', '标准入院记录模板', '{"header":[],"main":[{"id":"el_h1","type":"text","value":"入院记录","size":22,"font":"SimSun","bold":true,"rowFlex":"CENTER"},{"id":"el_br1","type":"text","value":"\\n"},{"id":"el_l1","type":"text","value":"姓名：","size":16,"font":"SimSun","bold":true},{"id":"el_c1","type":"control","value":"","control":{"controlType":"input","placeholder":"请输入姓名","width":120}},{"id":"el_br2","type":"text","value":"\\n"},{"id":"el_l2","type":"text","value":"性别：","size":16,"font":"SimSun","bold":true},{"id":"el_c2","type":"control","value":"","control":{"controlType":"select","options":[{"label":"男","value":"male"},{"label":"女","value":"female"}],"width":80}},{"id":"el_br3","type":"text","value":"\\n"},{"id":"el_l3","type":"text","value":"主诉：","size":16,"font":"SimSun","bold":true},{"id":"el_c3","type":"control","value":"","control":{"controlType":"textarea","placeholder":"请输入主诉","width":400}},{"id":"el_br4","type":"text","value":"\\n"}],"footer":[]}', 1, 1, 'u_designer_001', 'u_designer_001');

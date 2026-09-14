-- Copyright (c) 2026 陈庄旺.
-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at https://mozilla.org/MPL/2.0/.
-- SPDX-License-Identifier: MPL-2.0

-- ================================================================
-- EMRDocumentEngine DDL (架构 v20.34)
-- ================================================================

-- 文档表 (v20.34: model_version + version 乐观锁 + 加密)
CREATE TABLE IF NOT EXISTS t_document (
    id          VARCHAR(64)  PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    template_id VARCHAR(64),
    content     JSON         NOT NULL COMMENT 'DocumentTree JSON (ModelD v20.34 去分页化)',
    model_version VARCHAR(10) DEFAULT '4.0.0' COMMENT '文档模型版本号',
    encryption_key VARCHAR(512) COMMENT 'AES-WRAP 包裹的 DEK',
    kek_version INT DEFAULT 1 COMMENT 'KEK 版本号',
    status      VARCHAR(20)  DEFAULT 'draft',
    version     INT          DEFAULT 1 COMMENT '乐观锁版本号',
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted     TINYINT      DEFAULT 0,
    INDEX idx_template_id (template_id),
    INDEX idx_created_by (created_by),
    INDEX idx_status (status)
);

-- 文档版本
CREATE TABLE IF NOT EXISTS t_document_version (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    content     JSON         NOT NULL,
    title       VARCHAR(255),
    version     INT          NOT NULL,
    created_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_version (document_id, version)
);

-- 模板
CREATE TABLE IF NOT EXISTS t_template (
    id           VARCHAR(64)  PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    category     VARCHAR(100),
    description  TEXT,
    content      JSON         NOT NULL,
    model_version VARCHAR(10) DEFAULT '4.0.0',
    thumbnail    VARCHAR(500),
    is_public    TINYINT      DEFAULT 0,
    version      INT          DEFAULT 1,
    created_by   VARCHAR(64),
    updated_by   VARCHAR(64),
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted      TINYINT      DEFAULT 0,
    INDEX idx_category (category)
);

-- 用户
CREATE TABLE IF NOT EXISTS t_user (
    id       VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL COMMENT 'BCrypt',
    real_name VARCHAR(100),
    role     VARCHAR(50) DEFAULT 'doctor',
    level    INT DEFAULT 3,
    enabled  TINYINT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文档权限
CREATE TABLE IF NOT EXISTS t_document_permission (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    permission  VARCHAR(20)  NOT NULL COMMENT 'owner/editor/commenter/viewer',
    granted_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_doc_user (document_id, user_id)
);

-- 审计日志
CREATE TABLE IF NOT EXISTS t_audit_log (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    action      VARCHAR(50)  NOT NULL COMMENT 'create/edit/delete/print/export/view/share',
    detail      JSON,
    model_version VARCHAR(10),
    ip_address  VARCHAR(50),
    user_agent  VARCHAR(500),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id),
    INDEX idx_user_id (user_id),
    INDEX idx_action (action)
);

-- 质控规则
CREATE TABLE IF NOT EXISTS t_qc_rule (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(20)  NOT NULL COMMENT 'completeness/consistency/standardization',
    severity    VARCHAR(10)  DEFAULT 'error',
    weight      INT          DEFAULT 10,
    description TEXT,
    expression  JSON         NOT NULL COMMENT 'JSONLogic',
    enabled     TINYINT      DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 文档编辑锁
CREATE TABLE IF NOT EXISTS t_document_lock (
    document_id VARCHAR(64) PRIMARY KEY,
    user_id     VARCHAR(64) NOT NULL,
    locked_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME     NOT NULL
);

-- 批注
CREATE TABLE IF NOT EXISTS t_comment (
    id          VARCHAR(64)  PRIMARY KEY,
    thread_id   VARCHAR(64)  NOT NULL,
    document_id VARCHAR(64)  NOT NULL,
    author      VARCHAR(64)  NOT NULL,
    content     TEXT         NOT NULL,
    range_start JSON,
    range_end   JSON,
    status      VARCHAR(20)  DEFAULT 'open',
    base_version INT,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    edited_at   DATETIME,
    INDEX idx_thread (thread_id),
    INDEX idx_document (document_id)
);

-- 打印历史 (续打)
CREATE TABLE IF NOT EXISTS t_print_history (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    pages       VARCHAR(100) COMMENT '页码范围如 1-8',
    copies      INT          DEFAULT 1,
    completed   TINYINT      DEFAULT 0 COMMENT '0=未完成 1=已完成',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document (document_id)
);

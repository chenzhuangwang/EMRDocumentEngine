-- ============================================================
-- EMR Document Editor - 数据库初始化脚本
-- MySQL 8.0+
-- ============================================================

CREATE DATABASE IF NOT EXISTS emr_editor
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE emr_editor;

-- ---- 用户表 ----
CREATE TABLE IF NOT EXISTS t_user (
    id          VARCHAR(64)  PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    real_name   VARCHAR(100),
    role        VARCHAR(50)  DEFAULT 'user' COMMENT 'admin/designer/user/viewer',
    enabled     TINYINT      DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ---- 文档表 ----
CREATE TABLE IF NOT EXISTS t_document (
    id          VARCHAR(64)  PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    template_id VARCHAR(64),
    content     JSON         NOT NULL COMMENT '文档JSON内容: {header:[], main:[], footer:[]}',
    status      VARCHAR(20)  DEFAULT 'draft' COMMENT 'draft/published/archived',
    version     INT          DEFAULT 1,
    deleted     TINYINT      DEFAULT 0 COMMENT '逻辑删除',
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_template_id (template_id),
    INDEX idx_created_by (created_by),
    INDEX idx_status (status),
    INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文档表';

-- ---- 模板表 ----
CREATE TABLE IF NOT EXISTS t_template (
    id          VARCHAR(64)  PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    category    VARCHAR(100),
    description TEXT,
    content     JSON         NOT NULL COMMENT '模板JSON内容',
    thumbnail   VARCHAR(500) COMMENT '缩略图URL',
    is_public   TINYINT      DEFAULT 0,
    version     INT          DEFAULT 1,
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模板表';

-- ---- 文档版本表 ----
CREATE TABLE IF NOT EXISTS t_document_version (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    version     INT          NOT NULL,
    content     JSON         NOT NULL,
    created_by  VARCHAR(64)  NOT NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_version (document_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文档版本表';

-- ---- 操作审计日志表 ----
CREATE TABLE IF NOT EXISTS t_audit_log (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    action      VARCHAR(50)  NOT NULL COMMENT 'create/edit/delete/print/export/view',
    detail      JSON         COMMENT '操作详情',
    ip_address  VARCHAR(50),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志表';

-- ---- 批注表 ----
CREATE TABLE IF NOT EXISTS t_annotation (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    element_id  VARCHAR(64)  COMMENT '关联的元素ID',
    content     TEXT         NOT NULL,
    status      VARCHAR(20)  DEFAULT 'open' COMMENT 'open/resolved',
    created_by  VARCHAR(64)  NOT NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批注表';

-- ---- 批注回复表 ----
CREATE TABLE IF NOT EXISTS t_annotation_reply (
    id            VARCHAR(64)  PRIMARY KEY,
    annotation_id VARCHAR(64)  NOT NULL,
    content       TEXT         NOT NULL,
    created_by    VARCHAR(64)  NOT NULL,
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_annotation_id (annotation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批注回复表';

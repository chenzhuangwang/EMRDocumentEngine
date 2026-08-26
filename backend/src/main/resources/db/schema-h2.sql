-- H2 Schema (MySQL compatibility mode)
CREATE TABLE IF NOT EXISTS t_user (
    id          VARCHAR(64)  PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    real_name   VARCHAR(100),
    role        VARCHAR(50)  DEFAULT 'user',
    enabled     TINYINT      DEFAULT 1,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_document (
    id             VARCHAR(64)  PRIMARY KEY,
    title          VARCHAR(255) NOT NULL,
    template_id    VARCHAR(64),
    content        TEXT         NOT NULL,
    model_version  VARCHAR(10)  DEFAULT '4.0.0',
    encryption_key VARCHAR(512),
    kek_version    INT          DEFAULT 1,
    status         VARCHAR(20)  DEFAULT 'draft',
    version        INT          DEFAULT 1,
    deleted        TINYINT      DEFAULT 0,
    created_by     VARCHAR(64)  NOT NULL,
    updated_by     VARCHAR(64),
    created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_template (
    id          VARCHAR(64)  PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    category    VARCHAR(100),
    description TEXT,
    content     TEXT         NOT NULL,
    thumbnail   VARCHAR(500),
    is_public   TINYINT      DEFAULT 0,
    version     INT          DEFAULT 1,
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_document_version (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    version     INT          NOT NULL,
    content     TEXT         NOT NULL,
    created_by  VARCHAR(64)  NOT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_audit_log (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    action      VARCHAR(50)  NOT NULL,
    detail      TEXT,
    ip_address  VARCHAR(50),
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_annotation (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    element_id  VARCHAR(64),
    content     TEXT         NOT NULL,
    status      VARCHAR(20)  DEFAULT 'open',
    created_by  VARCHAR(64)  NOT NULL,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_annotation_reply (
    id            VARCHAR(64)  PRIMARY KEY,
    annotation_id VARCHAR(64)  NOT NULL,
    content       TEXT         NOT NULL,
    created_by    VARCHAR(64)  NOT NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

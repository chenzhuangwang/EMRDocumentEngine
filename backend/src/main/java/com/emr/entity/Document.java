/*
 * Copyright (c) 2026 陈庄旺.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

package com.emr.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_document")
public class Document {

    @TableId(type = IdType.ASSIGN_ID)
    private String id;

    private String title;

    private String templateId;

    /**
     * JSON content: DocumentTree (v20.34 去分页化, body: FlowBody)
     */
    private String content;

    /** 文档模型版本号 (用于兼容升级, 架构 v20.10: 统一 '4.0.0') */
    private String modelVersion;

    /** 加密后 DEK (AES-WRAP 包裹, 架构 §12.1.3) */
    private String encryptionKey;

    /** KEK 版本号 (密钥轮换, 架构 §12.1.3) */
    private Integer kekVersion;

    private String status;

    @Version
    private Integer version;

    private String createdBy;

    private String updatedBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}

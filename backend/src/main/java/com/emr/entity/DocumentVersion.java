package com.emr.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_document_version")
public class DocumentVersion {

    @TableId(type = IdType.ASSIGN_ID)
    private String id;

    private String documentId;

    private Integer version;

    private String content;

    private String createdBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}

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
     * JSON content: { header: [], main: [], footer: [] }
     */
    private String content;

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

package com.emr.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_annotation")
public class Annotation {

    @TableId(type = IdType.ASSIGN_ID)
    private String id;

    private String documentId;

    private String elementId;

    private String content;

    private String status;

    private String createdBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}

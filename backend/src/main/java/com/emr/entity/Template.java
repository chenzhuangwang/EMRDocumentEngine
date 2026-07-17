package com.emr.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("t_template")
public class Template {

    @TableId(type = IdType.ASSIGN_ID)
    private String id;

    private String name;

    private String category;

    private String description;

    /**
     * JSON content for template structure
     */
    private String content;

    private String thumbnail;

    private Integer isPublic;

    @Version
    private Integer version;

    private String createdBy;

    private String updatedBy;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}

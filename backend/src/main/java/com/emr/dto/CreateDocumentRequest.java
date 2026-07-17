package com.emr.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateDocumentRequest {

    @NotBlank(message = "Title is required")
    private String title;

    private String templateId;

    /**
     * JSON content: { header: [], main: [], footer: [] }
     */
    private String content;
}

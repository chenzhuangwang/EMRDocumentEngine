package com.emr.dto;

import lombok.Data;

@Data
public class UpdateDocumentRequest {

    private String title;
    private String content;
    private String status;
}

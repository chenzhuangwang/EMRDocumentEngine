/*
 * Copyright (c) 2026 陈庄旺.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

package com.emr.controller;

import com.emr.dto.ApiResponse;
import com.emr.dto.CreateDocumentRequest;
import com.emr.dto.PageResult;
import com.emr.dto.UpdateDocumentRequest;
import com.emr.entity.Document;
import com.emr.entity.User;
import com.emr.service.DocumentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/documents")
@RequiredArgsConstructor
public class DocumentController {

    private final DocumentService documentService;

    @GetMapping
    public ApiResponse<PageResult<Document>> list(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) String status
    ) {
        PageResult<Document> result = documentService.listDocuments(page, size, keyword, status);
        return ApiResponse.success(result);
    }

    @PostMapping
    public ApiResponse<Document> create(
        @RequestBody @Valid CreateDocumentRequest req,
        @AuthenticationPrincipal User user
    ) {
        Document doc = documentService.createDocument(req, user);
        return ApiResponse.success(doc);
    }

    @GetMapping("/{id}")
    public ApiResponse<Document> getById(@PathVariable String id) {
        Document doc = documentService.getDocument(id);
        if (doc == null) {
            return ApiResponse.error(404, "Document not found");
        }
        return ApiResponse.success(doc);
    }

    @PutMapping("/{id}")
    public ApiResponse<Document> update(
        @PathVariable String id,
        @RequestBody @Valid UpdateDocumentRequest req,
        @AuthenticationPrincipal User user
    ) {
        Document doc = documentService.updateDocument(id, req, user);
        return ApiResponse.success(doc);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        documentService.deleteDocument(id);
        return ApiResponse.success(null);
    }
}

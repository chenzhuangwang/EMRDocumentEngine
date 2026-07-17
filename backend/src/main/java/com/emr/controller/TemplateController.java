package com.emr.controller;

import com.emr.dto.ApiResponse;
import com.emr.entity.Template;
import com.emr.entity.User;
import com.emr.service.TemplateService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/templates")
@RequiredArgsConstructor
public class TemplateController {

    private final TemplateService templateService;

    @GetMapping
    public ApiResponse<List<Template>> list(
        @RequestParam(required = false) String category,
        @RequestParam(required = false) String keyword
    ) {
        List<Template> templates = templateService.listTemplates(category, keyword);
        return ApiResponse.success(templates);
    }

    @GetMapping("/{id}")
    public ApiResponse<Template> getById(@PathVariable String id) {
        Template tpl = templateService.getTemplate(id);
        if (tpl == null) {
            return ApiResponse.error(404, "Template not found");
        }
        return ApiResponse.success(tpl);
    }

    @PostMapping
    public ApiResponse<Template> create(
        @RequestBody Map<String, String> body,
        @AuthenticationPrincipal User user
    ) {
        Template tpl = templateService.createTemplate(
            body.get("name"),
            body.get("category"),
            body.get("description"),
            body.get("content"),
            user
        );
        return ApiResponse.success(tpl);
    }

    @PutMapping("/{id}")
    public ApiResponse<Template> update(
        @PathVariable String id,
        @RequestBody Map<String, String> body,
        @AuthenticationPrincipal User user
    ) {
        Template tpl = templateService.updateTemplate(
            id,
            body.get("name"),
            body.get("content"),
            user
        );
        return ApiResponse.success(tpl);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        templateService.deleteTemplate(id);
        return ApiResponse.success(null);
    }
}

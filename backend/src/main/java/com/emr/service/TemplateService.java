/*
 * Copyright (c) 2026 陈庄旺.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

package com.emr.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.emr.entity.Template;
import com.emr.entity.User;
import com.emr.repository.TemplateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class TemplateService {

    private final TemplateRepository templateRepository;

    public List<Template> listTemplates(String category, String keyword) {
        LambdaQueryWrapper<Template> wrapper = new LambdaQueryWrapper<>();

        if (category != null && !category.isBlank()) {
            wrapper.eq(Template::getCategory, category);
        }
        if (keyword != null && !keyword.isBlank()) {
            wrapper.like(Template::getName, keyword);
        }
        wrapper.orderByDesc(Template::getUpdatedAt);

        return templateRepository.selectList(wrapper);
    }

    public Template getTemplate(String id) {
        return templateRepository.selectById(id);
    }

    public Template createTemplate(String name, String category, String description,
                                    String content, User user) {
        Template tpl = new Template();
        tpl.setName(name);
        tpl.setCategory(category);
        tpl.setDescription(description);
        tpl.setContent(content);
        tpl.setIsPublic(0);
        tpl.setVersion(1);
        tpl.setCreatedBy(user.getId());
        tpl.setUpdatedBy(user.getId());
        tpl.setCreatedAt(LocalDateTime.now());
        tpl.setUpdatedAt(LocalDateTime.now());

        templateRepository.insert(tpl);
        return tpl;
    }

    public Template updateTemplate(String id, String name, String content, User user) {
        Template tpl = templateRepository.selectById(id);
        if (tpl == null) {
            throw new RuntimeException("Template not found: " + id);
        }

        if (name != null) tpl.setName(name);
        if (content != null) tpl.setContent(content);
        tpl.setUpdatedBy(user.getId());
        tpl.setUpdatedAt(LocalDateTime.now());
        templateRepository.updateById(tpl);

        return tpl;
    }

    public void deleteTemplate(String id) {
        templateRepository.deleteById(id);
    }
}

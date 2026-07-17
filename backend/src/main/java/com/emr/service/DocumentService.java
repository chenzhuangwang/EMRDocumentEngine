package com.emr.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emr.dto.CreateDocumentRequest;
import com.emr.dto.PageResult;
import com.emr.dto.UpdateDocumentRequest;
import com.emr.entity.Document;
import com.emr.entity.DocumentVersion;
import com.emr.entity.User;
import com.emr.repository.DocumentRepository;
import com.emr.repository.DocumentVersionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final DocumentVersionRepository versionRepository;

    public PageResult<Document> listDocuments(int page, int size, String keyword, String status) {
        Page<Document> pg = new Page<>(page, size);
        LambdaQueryWrapper<Document> wrapper = new LambdaQueryWrapper<>();

        if (keyword != null && !keyword.isBlank()) {
            wrapper.like(Document::getTitle, keyword);
        }
        if (status != null && !status.isBlank()) {
            wrapper.eq(Document::getStatus, status);
        }
        wrapper.orderByDesc(Document::getUpdatedAt);

        Page<Document> result = documentRepository.selectPage(pg, wrapper);

        return new PageResult<>(
            result.getRecords(),
            result.getTotal(),
            (int) result.getCurrent(),
            (int) result.getSize()
        );
    }

    public Document getDocument(String id) {
        return documentRepository.selectById(id);
    }

    @Transactional
    public Document createDocument(CreateDocumentRequest req, User user) {
        Document doc = new Document();
        doc.setTitle(req.getTitle());
        doc.setTemplateId(req.getTemplateId());
        doc.setContent(req.getContent());
        doc.setStatus("draft");
        doc.setVersion(1);
        doc.setCreatedBy(user.getId());
        doc.setUpdatedBy(user.getId());
        doc.setCreatedAt(LocalDateTime.now());
        doc.setUpdatedAt(LocalDateTime.now());

        documentRepository.insert(doc);

        // Save initial version
        DocumentVersion version = new DocumentVersion();
        version.setDocumentId(doc.getId());
        version.setVersion(1);
        version.setContent(req.getContent());
        version.setCreatedBy(user.getId());
        version.setCreatedAt(LocalDateTime.now());
        versionRepository.insert(version);

        return doc;
    }

    @Transactional
    public Document updateDocument(String id, UpdateDocumentRequest req, User user) {
        Document doc = documentRepository.selectById(id);
        if (doc == null) {
            throw new RuntimeException("Document not found: " + id);
        }

        if (req.getTitle() != null) {
            doc.setTitle(req.getTitle());
        }
        if (req.getContent() != null) {
            // Save version before updating content
            DocumentVersion version = new DocumentVersion();
            version.setDocumentId(doc.getId());
            version.setVersion(doc.getVersion() + 1);
            version.setContent(req.getContent());
            version.setCreatedBy(user.getId());
            version.setCreatedAt(LocalDateTime.now());
            versionRepository.insert(version);

            doc.setContent(req.getContent());
            doc.setVersion(doc.getVersion() + 1);
        }
        if (req.getStatus() != null) {
            doc.setStatus(req.getStatus());
        }

        doc.setUpdatedBy(user.getId());
        doc.setUpdatedAt(LocalDateTime.now());
        documentRepository.updateById(doc);

        return doc;
    }

    public void deleteDocument(String id) {
        documentRepository.deleteById(id);
    }
}

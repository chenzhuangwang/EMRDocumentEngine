package com.emr.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emr.entity.Document;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DocumentRepository extends BaseMapper<Document> {
}

package com.emr.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emr.entity.DocumentVersion;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DocumentVersionRepository extends BaseMapper<DocumentVersion> {
}

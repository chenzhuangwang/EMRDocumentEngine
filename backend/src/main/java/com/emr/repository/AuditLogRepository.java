package com.emr.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emr.entity.AuditLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface AuditLogRepository extends BaseMapper<AuditLog> {
}

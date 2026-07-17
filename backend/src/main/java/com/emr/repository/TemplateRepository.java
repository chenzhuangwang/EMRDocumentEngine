package com.emr.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emr.entity.Template;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface TemplateRepository extends BaseMapper<Template> {
}

package com.emr.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emr.entity.User;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface UserRepository extends BaseMapper<User> {

    @Select("SELECT * FROM t_user WHERE username = #{username}")
    User findByUsername(String username);
}

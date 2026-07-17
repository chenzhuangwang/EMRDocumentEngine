package com.emr.service;

import com.emr.dto.LoginRequest;
import com.emr.dto.LoginResponse;
import com.emr.dto.UserDTO;
import com.emr.entity.User;
import com.emr.repository.UserRepository;
import com.emr.util.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public LoginResponse login(LoginRequest req) {
        User user = userRepository.findByUsername(req.getUsername());
        if (user == null) {
            throw new RuntimeException("User not found");
        }
        if (user.getEnabled() == null || user.getEnabled() == 0) {
            throw new RuntimeException("User is disabled");
        }
        if (!passwordEncoder.matches(req.getPassword(), user.getPassword())) {
            throw new RuntimeException("Invalid password");
        }

        String accessToken = jwtUtil.generateToken(user.getId(), user.getUsername());
        String refreshToken = jwtUtil.generateToken(user.getId() + ":refresh", user.getUsername());

        UserDTO userDTO = new UserDTO(user.getId(), user.getUsername(), user.getRealName(), user.getRole());

        return new LoginResponse(accessToken, refreshToken, userDTO);
    }

    public UserDTO getCurrentUser(User user) {
        return new UserDTO(user.getId(), user.getUsername(), user.getRealName(), user.getRole());
    }
}

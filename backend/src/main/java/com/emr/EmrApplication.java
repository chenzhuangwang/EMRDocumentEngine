/*
 * Copyright (c) 2026 陈庄旺.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

package com.emr;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * EMR Document Editor - Main Application
 */
@SpringBootApplication
public class EmrApplication {

    public static void main(String[] args) {
        SpringApplication.run(EmrApplication.class, args);
    }
}

(function (global) {
    "use strict";

    function fetchJson(options) {
        return fetch(options.url, {
            signal: options.signal,
            headers: { "Accept": "application/json" }
        }).then(function (response) {
            return response.text().then(function (responseText) {
                var data = null;
                if (responseText.trim()) {
                    try {
                        data = JSON.parse(responseText);
                    } catch (parseError) {
                        throw new Error(
                            options.label + " 응답 형식이 올바르지 않습니다. (HTTP " +
                            response.status + ")"
                        );
                    }
                }
                if (!data) {
                    throw new Error(
                        options.label + " 서버가 빈 응답을 반환했습니다. (HTTP " +
                        response.status + ")"
                    );
                }
                if (!response.ok) {
                    throw new Error(data.error || options.label + " 서버 응답 오류");
                }
                if (!options.validate(data)) {
                    throw new Error(options.invalidMessage);
                }
                return data;
            });
        });
    }

    global.GisJsonApi = {
        fetch: fetchJson
    };
})(window);

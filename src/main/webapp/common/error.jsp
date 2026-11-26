<%@ page contentType="text/html; charset=utf-8" pageEncoding="utf-8"%>
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GIS 방향 스캔 오류</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: sans-serif; background: #f4f7f8; color: #173042; }
main { width: min(420px, calc(100% - 48px)); padding: 32px; border-radius: 16px; background: #fff; box-shadow: 0 16px 40px rgba(23, 48, 66, .12); }
h1 { margin-top: 0; font-size: 1.4rem; }
a { color: #007f79; }
</style>
</head>
<body>
<main>
    <h1>요청을 처리하지 못했습니다.</h1>
    <p>잠시 후 다시 시도하거나 지도 화면으로 돌아가 주세요.</p>
    <a href="${pageContext.request.contextPath}/map.jsp">지도 화면으로 돌아가기</a>
</main>
</body>
</html>

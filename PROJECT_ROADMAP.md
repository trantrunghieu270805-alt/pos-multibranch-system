# Kế hoạch cập nhật POS đa chi nhánh

## Mục tiêu

Mở rộng luồng đặt hàng hiện tại với:

1. Thanh toán trực tuyến bằng VietQR và xác nhận thanh toán tự động.
2. Chatbot AI gợi ý món ăn dựa trên thực đơn, sở thích và yêu cầu của khách hàng.

Đây là kế hoạch triển khai; các tính năng VietQR và chatbot chưa được tích hợp trong mã nguồn hiện tại.

## Hiện trạng dự án

- Khách hàng tạo đơn và xem trạng thái tại `frontend/src/pages/CustomerPage.jsx`.
- API tạo đơn và quản lý trạng thái nằm trong `backend/server.js`.
- Database hiện có `Orders`, `OrderItems`, `Products`, nhưng chưa có thông tin giao dịch thanh toán hoặc dữ liệu thành phần món ăn.
- `database/init_pos_db.sql` hiện xóa và tạo lại database `MultiBranchPOS`. Không chạy script này trên môi trường có dữ liệu cần giữ; khi triển khai thật, dùng migration có kiểm soát thay vì reset database.

## 1. Thanh toán VietQR

### Luồng đề xuất

1. Khách chọn món và gửi đơn.
2. Backend tính tổng tiền từ giá trong database, tạo đơn và một giao dịch thanh toán `PENDING`.
3. Backend tạo mã tham chiếu duy nhất cho đơn và yêu cầu VietQR/ngân hàng/đơn vị thanh toán tạo QR động.
4. Frontend hiển thị QR, số tiền, ngân hàng nhận và nội dung chuyển khoản.
5. Backend chỉ đánh dấu giao dịch `PAID` sau khi xác minh webhook hoặc truy vấn giao dịch với đơn vị thanh toán.
6. Backend phát Socket.io event để cập nhật trạng thái thanh toán cho khách hàng và quản lý.
7. Theo chính sách kinh doanh, đơn chỉ được quản lý duyệt/chuyển xuống bếp sau khi thanh toán thành công; đơn hết hạn hoặc thanh toán thất bại không được xử lý tiếp.

Không xác nhận thanh toán dựa trên ảnh chụp màn hình hoặc thông tin do trình duyệt gửi lên.

### Database cần cập nhật

- Tạo bảng `Payments` để lưu lịch sử giao dịch, tách khỏi trạng thái giao hàng của `Orders`.
- Các trường gợi ý:
  - `PaymentID`, `OrderID`, `Provider`, `Amount`, `Currency`.
  - `PaymentReference` duy nhất, `ProviderTransactionID` duy nhất khi có.
  - `Status` (`PENDING`, `PAID`, `FAILED`, `EXPIRED`, `REFUNDED`).
  - `CreatedAt`, `PaidAt`, `ExpiresAt`, `ProviderPayload` tối giản để đối soát.
- Tạo index theo `OrderID`, `PaymentReference`, `ProviderTransactionID`, `Status`.
- Trạng thái đơn hàng hiện có tiếp tục biểu thị quy trình chế biến/giao hàng; không dùng chung để biểu diễn trạng thái thanh toán.
- Viết migration riêng cho database hiện hữu. Không thêm thay đổi vào script reset để chạy trên production.

### Backend cần cập nhật

- Thêm service tạo QR và chuẩn hóa phản hồi từ nhà cung cấp.
- Thêm API khởi tạo hoặc lấy thông tin thanh toán cho đơn của chính khách hàng.
- Thêm webhook nhận kết quả thanh toán. Xác minh chữ ký/xác thực theo tài liệu nhà cung cấp, số tiền, mã tham chiếu, trạng thái và giao dịch trùng lặp.
- Xử lý webhook idempotent: cùng một thông báo gửi lại nhiều lần không được ghi nhận thanh toán hoặc phát event nhiều lần.
- Chỉ cho phép chuyển thanh toán `PENDING` sang trạng thái hợp lệ; không cho sự kiện cũ ghi đè một giao dịch đã hoàn tất.
- Phát event như `payment_updated` sau khi transaction database commit.
- Lưu cấu hình nhạy cảm trong biến môi trường backend, ví dụ `VIETQR_PROVIDER`, `VIETQR_API_URL`, `VIETQR_CLIENT_ID`, `VIETQR_API_KEY`, `VIETQR_WEBHOOK_SECRET`. Chỉ đưa tên biến vào `.env.example`, không commit giá trị thật.
- Nếu chọn QR tĩnh/chuyển khoản không có webhook đáng tin cậy, cần quy trình đối soát thủ công hoặc API kiểm tra giao dịch; QR tĩnh đơn thuần không chứng minh khách đã chuyển tiền.

### Frontend cần cập nhật

- Bổ sung bước thanh toán trên trang khách hàng: QR, số tiền, nội dung chuyển khoản, hạn thanh toán và nút kiểm tra trạng thái.
- Nhận cập nhật qua Socket.io; có thể gọi API kiểm tra lại khi mất kết nối.
- Hiển thị rõ `Chờ thanh toán`, `Đã thanh toán`, `Thất bại` hoặc `Hết hạn`.
- Cho phép tạo lại giao dịch khi giao dịch cũ hết hạn mà không tạo đơn hàng trùng.
- Trang quản lý hiển thị trạng thái và mã giao dịch để hỗ trợ đối soát.

### Tiêu chí nghiệm thu VietQR

- Mã QR chứa đúng tài khoản nhận, số tiền và nội dung tham chiếu của đơn.
- Thanh toán hợp lệ chỉ được ghi nhận một lần, kể cả khi webhook được gửi lặp lại.
- Sai chữ ký, sai số tiền, sai tham chiếu hoặc giao dịch hết hạn không được đánh dấu đã thanh toán.
- Khách và quản lý thấy trạng thái mới theo thời gian thực.
- Đơn chưa thanh toán không thể đi vào bước duyệt/chế biến theo chính sách đã chọn.

## 2. Chatbot AI gợi ý món ăn

### Trải nghiệm đề xuất

- Thêm widget chat vào trang khách hàng.
- Hỏi nhanh về khẩu vị, ngân sách, món chay, dị ứng, mức cay, số người ăn hoặc loại đồ uống.
- Gợi ý một số món hiện có, kèm giá và lý do đề xuất; cho phép thêm món vào giỏ sau khi khách xác nhận.
- Không tự đặt hàng, thay đổi giỏ hoặc thanh toán nếu khách chưa xác nhận.
- Khi khách nêu dị ứng, ưu tiên loại món đã được đánh dấu dữ liệu phù hợp; nếu database chưa có thông tin thành phần thì chatbot phải nói rõ chưa xác minh được, không tự khẳng định món an toàn.

### Dữ liệu thực đơn cần bổ sung

- Mô tả món, thành phần, nhãn ăn chay/thuần chay, mức cay và thông tin dị ứng.
- Có thể thêm bảng thành phần/nhãn riêng nếu danh mục dữ liệu tăng; không đưa thông tin dị ứng vào chỉ dẫn tự do không kiểm duyệt.
- Chatbot chỉ được gợi ý món đang có trong chi nhánh và còn bán.

### Backend và AI service

- Thêm API có xác thực, giới hạn tần suất, ví dụ `POST /api/customer/assistant/recommendations`.
- Backend truy vấn thực đơn phù hợp rồi gửi cho AI dưới dạng dữ liệu giới hạn; không cho AI truy cập SQL tùy ý hoặc tự gọi các API quản lý.
- Yêu cầu AI trả kết quả theo cấu trúc đã định nghĩa, chẳng hạn danh sách `ProductID`, lời giải thích ngắn và câu hỏi làm rõ.
- Backend phải kiểm tra lại `ProductID`, tình trạng còn bán, chi nhánh và giá trước khi trả kết quả.
- Khóa API AI chỉ được lưu ở backend. Không gửi thông tin thanh toán, mật khẩu, token hoặc địa chỉ giao hàng cho mô hình.
- Thêm timeout, giới hạn độ dài hội thoại, xử lý lỗi nhà cung cấp và thông báo rõ khi chatbot tạm không khả dụng.
- Có thể triển khai gợi ý theo luật/danh mục làm phương án dự phòng khi AI chưa được cấu hình.

### Frontend cần cập nhật

- Tạo chat widget có trạng thái đang trả lời, lỗi, thử lại và danh sách gợi ý dạng thẻ món.
- Hiển thị tên món, giá lấy từ backend và nút “Thêm vào giỏ”.
- Cho phép khách chỉnh sửa/xóa tin nhắn hoặc bắt đầu cuộc hội thoại mới.
- Không hiển thị nội dung AI như thông tin thành phần đã xác thực nếu database chưa có dữ liệu tương ứng.

### Tiêu chí nghiệm thu chatbot

- Chỉ gợi ý món có thật, đang bán và đúng chi nhánh; giá phải khớp database.
- Không tự thêm món hoặc gửi đơn khi chưa có thao tác xác nhận của khách.
- Yêu cầu về dị ứng được xử lý thận trọng; không khẳng định an toàn khi thiếu dữ liệu thành phần.
- Prompt độc hại trong tin nhắn không làm chatbot lộ dữ liệu, truy cập chức năng quản lý hoặc bỏ qua giới hạn.
- Khi dịch vụ AI lỗi/quá thời gian, trang đặt hàng vẫn sử dụng được.

## 3. Các giai đoạn triển khai

1. **Chốt nghiệp vụ và nhà cung cấp:** chọn ngân hàng/đơn vị hỗ trợ VietQR động, cơ chế webhook/đối soát, chính sách đơn chưa thanh toán và nhà cung cấp AI.
2. **Thiết kế migration:** bổ sung bảng giao dịch và dữ liệu thực đơn; có backup trước khi áp dụng lên database đang dùng.
3. **Xây backend:** service thanh toán, webhook, chống xử lý lặp, API chatbot và kiểm tra đầu ra.
4. **Xây frontend:** trải nghiệm QR, trạng thái thanh toán, chat widget và thao tác thêm món.
5. **Kiểm thử:** unit/integration test cho webhook, quyền truy cập, cập nhật real-time, gợi ý sai dữ liệu, timeout và tình huống ngoại lệ.
6. **Triển khai thử nghiệm:** dùng môi trường sandbox/test của nhà cung cấp trước, sau đó mới cấu hình production.

## 4. Quyết định cần có trước khi bắt đầu code

- Ngân hàng hoặc nhà cung cấp VietQR nào sẽ nhận tiền? Có webhook xác thực hoặc API đối soát không?
- Khách phải thanh toán trước khi quản lý duyệt đơn, hay cho phép thanh toán khi nhận hàng?
- Thời hạn giữ một QR/giao dịch là bao lâu? Có cho phép hoàn tiền không?
- Dùng nhà cung cấp AI nào, giới hạn chi phí và thời gian lưu hội thoại ra sao?
- Những thông tin dị ứng/thành phần nào sẽ được quản lý nhập và xác nhận?
